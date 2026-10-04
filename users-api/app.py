"""Users service: manages store customers, backed by PostgreSQL."""
import logging
import os
import re
import threading
from contextlib import contextmanager

import psycopg2
from flask import Flask, abort, jsonify, request, url_for
from psycopg2 import errors, pool
from psycopg2.extras import RealDictCursor
from werkzeug.exceptions import HTTPException

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("users-api")

app = Flask(__name__)

# --------------------------------------------------------------------------
# Database configuration & connection pool
# --------------------------------------------------------------------------
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "port": int(os.environ.get("DB_PORT", "5432")),
    "dbname": os.environ.get("DB_NAME", "ecommerce"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASS", ""),
    "connect_timeout": int(os.environ.get("DB_CONNECT_TIMEOUT", "5")),
}
DB_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "10"))

SCHEMA_LOCK_ID = 7001  # advisory lock so concurrent workers don't race on DDL
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    name       TEXT        NOT NULL,
    email      TEXT        NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""
SEED_USERS = [("Alice", "alice@example.com"), ("Bob", "bob@example.com")]

_pool = None
_pool_lock = threading.Lock()


def initialise_schema(db_pool):
    """Create tables and seed demo data on first start."""
    conn = db_pool.getconn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (SCHEMA_LOCK_ID,))
            cur.execute(SCHEMA)
            cur.execute("SELECT COUNT(*) FROM users")
            if cur.fetchone()[0] == 0:
                cur.executemany(
                    "INSERT INTO users (name, email) VALUES (%s, %s)", SEED_USERS
                )
    finally:
        db_pool.putconn(conn)


def get_pool():
    """Lazily create the pool so the service can start before the DB is ready."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                new_pool = pool.ThreadedConnectionPool(1, DB_POOL_MAX, **DB_CONFIG)
                try:
                    initialise_schema(new_pool)
                except Exception:
                    new_pool.closeall()
                    raise
                _pool = new_pool
                logger.info("Connected to database %s@%s", DB_CONFIG["dbname"], DB_CONFIG["host"])
    return _pool


@contextmanager
def db_cursor():
    """Yield a dict cursor; commit on success, roll back on error."""
    db_pool = get_pool()
    conn = db_pool.getconn()
    try:
        with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
    finally:
        db_pool.putconn(conn)


# --------------------------------------------------------------------------
# Validation helpers & error handling
# --------------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ValidationError(ValueError):
    """Raised when a request payload is invalid."""


def read_json_object():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("Request body must be a JSON object")
    return data


def parse_user(data):
    name = data.get("name")
    email = data.get("email")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        raise ValidationError("'name' is required (1-100 characters)")
    if not isinstance(email, str) or len(email) > 254 or not EMAIL_RE.match(email.strip()):
        raise ValidationError("'email' must be a valid email address")
    return name.strip(), email.strip().lower()


def serialize(row):
    user = dict(row)
    user["created_at"] = user["created_at"].isoformat()
    return user


@app.errorhandler(ValidationError)
def handle_validation_error(err):
    return jsonify(error=str(err)), 400


@app.errorhandler(HTTPException)
def handle_http_error(err):
    return jsonify(error=err.description or err.name), err.code


@app.errorhandler(psycopg2.OperationalError)
@app.errorhandler(pool.PoolError)
def handle_db_unavailable(err):
    logger.error("Database unavailable: %s", err)
    return jsonify(error="Database unavailable"), 503


@app.errorhandler(Exception)
def handle_unexpected(err):
    logger.exception("Unhandled error")
    return jsonify(error="Internal server error"), 500


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
USER_COLUMNS = "id, name, email, created_at"


@app.get("/health")
def health():
    with db_cursor() as cur:
        cur.execute("SELECT 1")
    return jsonify(status="ok")


@app.get("/users")
def list_users():
    with db_cursor() as cur:
        cur.execute(f"SELECT {USER_COLUMNS} FROM users ORDER BY id")
        return jsonify([serialize(row) for row in cur.fetchall()])


@app.get("/users/<int:user_id>")
def get_user(user_id):
    with db_cursor() as cur:
        cur.execute(f"SELECT {USER_COLUMNS} FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    if row is None:
        abort(404, description="User not found")
    return jsonify(serialize(row))


@app.post("/users")
def create_user():
    name, email = parse_user(read_json_object())
    try:
        with db_cursor() as cur:
            cur.execute(
                f"INSERT INTO users (name, email) VALUES (%s, %s) RETURNING {USER_COLUMNS}",
                (name, email),
            )
            user = serialize(cur.fetchone())
    except errors.UniqueViolation:
        abort(409, description="A user with this email already exists")
    return jsonify(user), 201, {"Location": url_for("get_user", user_id=user["id"])}


@app.delete("/users/<int:user_id>")
def delete_user(user_id):
    with db_cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s RETURNING id", (user_id,))
        deleted = cur.fetchone()
    if deleted is None:
        abort(404, description="User not found")
    return "", 204


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5001")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
