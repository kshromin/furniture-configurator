#!/usr/bin/env python3
"""Генератор секретов для self-host Supabase.

Supabase проверяет ключи клиентов подписью: есть один секрет (JWT_SECRET), а ANON_KEY и
SERVICE_ROLE_KEY — это JWT-токены, подписанные этим секретом. Сгенерировать их надо ровно один раз,
на своём сервере, и больше нигде не показывать.

Запуск:  python3 gen-keys.py            (срок ключей — 10 лет)
         python3 gen-keys.py --years 5

Печатает готовые строки для .env. Ничего никуда не отправляет, зависимостей нет.
"""

import argparse
import base64
import hashlib
import hmac
import json
import secrets
import time


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def make_jwt(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = "{}.{}".format(
        b64url(json.dumps(header, separators=(",", ":")).encode()),
        b64url(json.dumps(payload, separators=(",", ":")).encode()),
    )
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return "{}.{}".format(signing_input, b64url(signature))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=int, default=10, help="срок жизни ключей, лет")
    args = parser.parse_args()

    jwt_secret = secrets.token_urlsafe(48)          # длиннее минимальных 32 символов
    postgres_password = secrets.token_urlsafe(24)
    dashboard_password = secrets.token_urlsafe(18)

    issued = int(time.time())
    expires = issued + args.years * 365 * 24 * 3600

    anon = make_jwt({"role": "anon", "iss": "supabase", "iat": issued, "exp": expires}, jwt_secret)
    service = make_jwt(
        {"role": "service_role", "iss": "supabase", "iat": issued, "exp": expires}, jwt_secret
    )

    print("# --- вставить в .env, сохранить в надёжном месте ---")
    print(f"POSTGRES_PASSWORD={postgres_password}")
    print(f"JWT_SECRET={jwt_secret}")
    print(f"ANON_KEY={anon}")
    print(f"SERVICE_ROLE_KEY={service}")
    print(f"DASHBOARD_USERNAME=admin")
    print(f"DASHBOARD_PASSWORD={dashboard_password}")
    print()
    print(f"# ключи действительны до {time.strftime('%d.%m.%Y', time.localtime(expires))}")
    print("# ANON_KEY уходит в браузер — это нормально, он и задуман публичным")
    print("# SERVICE_ROLE_KEY обходит все правила доступа — только на сервере, никогда в браузер")


if __name__ == "__main__":
    main()
