"""
admin_delete_user.py
====================

Hard-delete every trace of a Hanu user. Three phases:

1. DB rows: call public.delete_user_completely(p_user_id) which wipes every
   table that has a user_id column (plus profiles).
2. Storage: bulk-delete every object under voice-notes/<user_id>/.
3. Auth: DELETE /auth/v1/admin/users/<user_id> via the Supabase Admin API.

Usage:
    python admin_delete_user.py <user_id> --confirm

The --confirm flag is mandatory; the script refuses otherwise. There is no
rollback; restore from a Supabase snapshot if you run this in error.

Environment (read from /root/.hermes/.env or process env):
    SUPABASE_URL
    SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
"""
from __future__ import annotations

import os
import sys

import requests

from db import sb  # supabase service-role client


def _hdr() -> dict:
    return {
        "Authorization": f"Bearer {os.environ['SUPABASE_SECRET_KEY']}",
        "apikey": os.environ["SUPABASE_SECRET_KEY"],
        "Content-Type": "application/json",
    }


def delete_db(user_id: str) -> None:
    sb().rpc("delete_user_completely", {"p_user_id": user_id}).execute()


def delete_storage(user_id: str) -> int:
    """List storage objects under voice-notes/<user_id>/ and remove them. Best-effort."""
    url = f"{os.environ['SUPABASE_URL'].rstrip('/')}/storage/v1/object/list/voice-notes"
    r = requests.post(
        url,
        json={"prefix": f"{user_id}/", "limit": 1000},
        headers=_hdr(),
        timeout=30,
    )
    r.raise_for_status()
    objs = r.json() or []
    keys = [f"{user_id}/{o['name']}" for o in objs]
    if not keys:
        return 0
    del_url = f"{os.environ['SUPABASE_URL'].rstrip('/')}/storage/v1/object/voice-notes"
    rr = requests.delete(del_url, json={"prefixes": keys}, headers=_hdr(), timeout=30)
    rr.raise_for_status()
    return len(keys)


def delete_auth_user(user_id: str) -> None:
    url = f"{os.environ['SUPABASE_URL'].rstrip('/')}/auth/v1/admin/users/{user_id}"
    r = requests.delete(url, headers=_hdr(), timeout=30)
    if r.status_code not in (200, 204, 404):
        raise RuntimeError(f"auth delete failed: {r.status_code} {r.text}")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] in {"-h", "--help"}:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    if "--confirm" not in sys.argv:
        print("Refusing to delete without --confirm. This action is irreversible.",
              file=sys.stderr)
        sys.exit(2)

    uid = sys.argv[1]
    print(f"[1/3] DB rows for user {uid} ...")
    delete_db(uid)

    print(f"[2/3] Storage objects under voice-notes/{uid}/ ...")
    moved = delete_storage(uid)
    print(f"      removed {moved} object(s).")

    print(f"[3/3] auth.users row {uid} ...")
    delete_auth_user(uid)

    print("Done.")


if __name__ == "__main__":
    main()
