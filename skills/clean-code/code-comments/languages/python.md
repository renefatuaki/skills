# Python

Doc comments are docstrings: `"""..."""` right under the `def` or `class` line. PyCharm and Pylance show them in the hover at every call site, and PyCharm renders reStructuredText links clickable in Quick Documentation. Plain URLs in `#` comments are Ctrl-clickable in the editor.

## Summary line

PEP 257: one line, imperative mood, period, closing quotes on the same line.

```python
def parse_cursor(raw: str) -> Cursor:
    """Return the cursor encoded in the pagination token."""
```

## Link line

Docstring: summary, blank line, reStructuredText link. Three lines, the only three-line comment the rules allow, because PEP 257 requires the blank line after the summary.

```python
async def fetch_user(session: ClientSession, user_id: int) -> User:
    """Fetch the user with a per-request timeout instead of the session default.

    `aiohttp client timeouts <https://docs.aiohttp.org/en/stable/client_quickstart.html#timeouts>`_
    """
```

Step comment inside a body: numbered steps, the bare URL on its own unnumbered `#` line right under the step.

```python
async def sync() -> None:
    # 1. Resolve the token first so a retry never races the keyring read.
    token = await token_store.current()
    # 2. Ask the server for a delta instead of a full sync.
    # https://docs.aiohttp.org/en/stable/client_quickstart.html#make-a-request
    changes = await api.changes(since=cursor, token=token)
    # 3. Apply the delta in one transaction so a crash never leaves half a sync on disk.
    async with db.transaction():
        await store.apply(changes)
```

## Django and FastAPI

Django: put a ticket reference at the end of the sentence on the same line, `(#12345)`. FastAPI: the path operation docstring becomes the OpenAPI description, so keep it the one-line summary API users should read.

## Before and after

Before:

```python
def fetch_user(user_id: int) -> User:
    """Fetches the user — also caches it; see docs

    Args:
        user_id: the user id
    Returns:
        the user
    """
```

After:

```python
def fetch_user(user_id: int) -> User:
    """Fetch the user and cache the result for the session."""
```

Before:

```python
def count(self) -> int:
    """Return the count."""
```

After:

```python
def count(self) -> int:
```
