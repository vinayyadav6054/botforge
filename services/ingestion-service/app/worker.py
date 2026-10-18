import json
import logging
import time
import uuid

import pika

from . import config, db
from .chunking import chunk_text
from .embedder import embed, get_model
from .parsing import extract_text, resolve_storage_path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ingestion")


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
    text = extract_text(path)
    chunks = chunk_text(text, config.CHUNK_SIZE, config.CHUNK_OVERLAP)
    if not chunks:
        raise ValueError("No text could be extracted from the document")

    vectors = embed(chunks)
    db.replace_chunks(conn, tenant_id, bot_id, document_id, chunks, vectors)
    return len(chunks)


def main() -> None:
    conn = db.connect()
    db.ensure_schema(conn)

    log.info("Loading embedding model (the first run downloads it, ~100 MB)...")
    get_model()

    credentials = pika.PlainCredentials(config.RABBITMQ_USER, config.RABBITMQ_PASSWORD)
    params = pika.ConnectionParameters(
        host=config.RABBITMQ_HOST, port=config.RABBITMQ_PORT,
        credentials=credentials, heartbeat=600,
    )
    mq = pika.BlockingConnection(params)
    channel = mq.channel()
    channel.exchange_declare(exchange=config.EXCHANGE, exchange_type="topic", durable=True)
    channel.queue_declare(queue=config.QUEUE, durable=True)
    channel.queue_bind(queue=config.QUEUE, exchange=config.EXCHANGE, routing_key="document.uploaded")
    channel.basic_qos(prefetch_count=1)

    def on_message(ch, method, properties, body):
        nonlocal conn
        msg = None
        try:
            msg = json.loads(body)
            started = time.time()
            count = process(conn, msg)
            publish(ch, "document.processed", {
                "documentId": msg["documentId"], "tenantId": msg["tenantId"],
                "botId": msg["botId"], "chunkCount": count,
            })
            log.info("Processed %s (%s) -> %d chunk(s) in %.1fs",
                     msg["documentId"], msg.get("fileName"), count, time.time() - started)
        except Exception as ex:
            log.exception("Failed to process message")
            try:
                if conn.closed:
                    conn = db.connect()
                else:
                    conn.rollback()
            except Exception:
                log.exception("Could not recover the database connection")
            if msg:
                publish(ch, "document.failed", {
                    "documentId": msg.get("documentId"), "tenantId": msg.get("tenantId"),
                    "botId": msg.get("botId"), "error": str(ex)[:500],
                })
        finally:
            # always ack so one bad message can never block the queue
            ch.basic_ack(delivery_tag=method.delivery_tag)

    channel.basic_consume(queue=config.QUEUE, on_message_callback=on_message)
    log.info("Ingestion worker ready, waiting for documents on '%s'", config.QUEUE)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        channel.stop_consuming()
    finally:
        mq.close()
        conn.close()


if __name__ == "__main__":
    main()
