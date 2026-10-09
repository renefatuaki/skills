#!/usr/bin/env python3
# Copyright 2026 René El Fatuaki
# Licensed under the MIT License
# https://opensource.org/license/mit
import os

def parse_cursor(raw: str) -> str:
    """Return the cursor encoded in the pagination token."""
    return raw

async def fetch_user(user_id: int) -> int:
    """Fetch the user with a per-request timeout instead of the session default.

    `aiohttp client timeouts <https://docs.aiohttp.org/en/stable/client_quickstart.html#timeouts>`_
    """
    # Resolve the token before the first request.
    # https://docs.aiohttp.org/en/stable/client_quickstart.html
    token = user_id  # noqa: F841
    return token

# TODO: handle timeout https://github.com/example/app/issues/7
def todo(): pass
