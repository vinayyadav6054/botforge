import json
import logging
import time
import uuid

import pika
from pika.exceptions import AMQPConnectionError, ChannelClosedByBroker, StreamLostError

from . import config, db
from .chunking import chunk_text
from .embedder import embed, get_model
from .parsing import extract_text, resolve_storage_path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ingestion")

ROUTING_KEYS = ("document.uploaded", "document.deleted", "bot.deleted")


def publish(channel, routing_key: str, payload: dict) -> None:
    channel.basic_publish(
        exchange=config.EXCHANGE,
        routing_key=routing_key,
        body=json.dumps(payload).encode("utf-8"),
        properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
    )


def process(conn, msg: dict) -> int:
    tenant_id = uuid.UUID(msg["tenantId"])
    bot_id = uuid.UUID(msg["botId"])
    document_id = uuid.UUID(msg["documentId"])

    path = resolve_storage_path(msg["storageKey"])
    if not path.is_file():
        raise FileNotFoundError("The uploaded file could not be found in storage")
    text = extract_text(path)
    chunks = chunk_text(text, config.CHUNK_SIZE, config.CHUNK_OVERLAP)
    if not chunks:
        raise ValueError("No text could be extracted from the document")

    vectors = embed(chunks)
    db.replace_chunks(conn, tenant_id, bot_id, document_id, chunks, vectors)
    return len(chunks)


class Handler:
    """Handles one message at a time. Kept separate from pika so it can be tested."""

    def __init__(self, conn, publish_fn):
        self.conn = conn
        self.publish = publish_fn

    def handle(self, routing_key: str, body: bytes) -> None:
        msg = None
        try:
            msg = json.loads(body)
            if routing_key == "document.deleted":
                n = db.delete_document_chunks(self.conn, uuid.UUID(msg["tenantId"]), uuid.UUID(msg["documentId"]))
                log.info("Deleted %d chunk(s) of document %s", n, msg["documentId"])
            elif routing_key == "bot.deleted":
                n = db.delete_bot_chunks(self.conn, uuid.UUID(msg["tenantId"]), uuid.UUID(msg["botId"]))
                log.info("Deleted %d chunk(s) of bot %s", n, msg["botId"])
            else:
                started = time.time()
                count = process(self.conn, msg)
                self.publish("document.processed", {
                    "documentId": msg["documentId"], "tenantId": msg["tenantId"],
                    "botId": msg["botId"], "chunkCount": count,
                })
                log.info("Processed %s (%s) -> %d chunk(s) in %.1fs",
                         msg["documentId"], msg.get("fileName"), count, time.time() - started)
        except Exception as ex:
            log.exception("Failed to handle %s message", routing_key)
            self._recover_db()
            # only uploads report a failure back; and only when we know which document it was
            if routing_key == "document.uploaded" and isinstance(msg, dict) and msg.get("documentId") and msg.get("tenantId"):
                self.publish("document.failed", {
                    "documentId": msg["documentId"], "tenantId": msg["tenantId"],
                    "botId": msg.get("botId"), "error": str(ex)[:500],
                })

    def _recover_db(self) -> None:
        try:
            if self.conn.closed:
                self.conn = db.connect()
            else:
                self.conn.rollback()
        except Exception:
            log.exception("Could not recover the database connection")


def consume(handler: Handler) -> None:
    credentials = pika.PlainCredentials(config.RABBITMQ_USER, config.RABBITMQ_PASSWORD)
    params = pika.ConnectionParameters(
        host=config.RABBITMQ_HOST, port=config.RABBITMQ_PORT,
        credentials=credentials, heartbeat=600,
    )
    mq = pika.BlockingConnection(params)
    try:
        channel = mq.channel()
        channel.exchange_declare(exchange=config.EXCHANGE, exchange_type="topic", durable=True)
        channel.queue_declare(queue=config.QUEUE, durable=True)
        for key in ROUTING_KEYS:
            channel.queue_bind(queue=config.QUEUE, exchange=config.EXCHANGE, routing_key=key)
        channel.basic_qos(prefetch_count=1)
        handler.publish = lambda key, payload: publish(channel, key, payload)

        def on_message(ch, method, properties, body):
            try:
                handler.handle(method.routing_key, body)
            finally:
                # always ack so one bad message can never block the queue
                ch.basic_ack(delivery_tag=method.delivery_tag)

        channel.basic_consume(queue=config.QUEUE, on_message_callback=on_message)
        log.info("Ingestion worker ready, waiting for messages on '%s'", config.QUEUE)
        channel.start_consuming()
    finally:
        if mq.is_open:
            mq.close()


def main() -> None:
    conn = db.connect()
    db.ensure_schema(conn)

    log.info("Loading embedding model (the first run downloads it, ~100 MB)...")
    get_model()

    handler = Handler(conn, publish_fn=None)
    try:
        while True:
            try:
                consume(handler)
            except (AMQPConnectionError, StreamLostError, ChannelClosedByBroker) as ex:
                log.warning("RabbitMQ connection lost (%s), reconnecting in 5 seconds", ex)
                time.sleep(5)
    except KeyboardInterrupt:
        log.info("Stopping")
    finally:
        handler.conn.close()


if __name__ == "__main__":
    main()
