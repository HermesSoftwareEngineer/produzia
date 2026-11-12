import threading
import time


class TTLCache:
    """Cache em memoria por processo; evita repetir chamadas ao Trello em sequencia."""

    def __init__(self):
        self._data = {}
        self._lock = threading.Lock()

    def get_or_set(self, key, ttl, factory):
        now = time.monotonic()
        with self._lock:
            hit = self._data.get(key)
            if hit and hit[0] > now:
                return hit[1]
        value = factory()
        with self._lock:
            self._data[key] = (now + ttl, value)
        return value

    def clear(self):
        with self._lock:
            self._data.clear()
