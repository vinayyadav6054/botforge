"""Small in-memory caches (one process; safe from threads). They make repeated work free: the same question's
embedding, translation and, when the same knowledge matches, its answer."""
import threading
import time
from collections import OrderedDict


class TTLCache:
    """Least-recently-used cache whose entries also expire after `ttl` seconds."""

    def __init__(self, maxsize: int, ttl: float):
        self.maxsize, self.ttl = maxsize, ttl
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self.hits = self.misses = 0

    def get(self, key):
        with self._lock:
            item = self._data.get(key)
            if item is None or item[1] < time.monotonic():
                if item is not None:
                    del self._data[key]
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return item[0]

    def set(self, key, value) -> None:
        with self._lock:
            self._data[key] = (value, time.monotonic() + self.ttl)
            self._data.move_to_end(key)
            while len(self._data) > self.maxsize:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self.hits = self.misses = 0

    def __len__(self) -> int:
        return len(self._data)
