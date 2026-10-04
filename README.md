# Ecommerce Webapp

A small microservices-based ecommerce application: a Flask storefront plus four
Flask APIs, with PostgreSQL for persistence.

## Services

| Service | Port | Purpose | Database |
|---|---|---|---|
| `frontend` | 5000 | Storefront UI; proxies `/api/*` calls to the backend services | – |
| `users-api` | 5001 | Customers (create, list, fetch, delete) | PostgreSQL |
| `products-api` | 5002 | Product catalogue (create, list, fetch, delete) | PostgreSQL |
| `orders-api` | 5003 | Orders; validates the user and products with the other services and snapshots prices | PostgreSQL |
| `uploads-api` | 5004 | Image uploads (PNG/JPEG/GIF/WebP) stored locally or in S3 | – |

The APIs create their tables and seed demo data (users, products) automatically on
first connection, so an empty database is all you need.

## Prerequisites

- Python 3.8+
- A running PostgreSQL instance, e.g. from Docker:

```bash
docker run -d --name ecommerce-db \
  -e POSTGRES_DB=ecommerce -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16
```

## Run locally

Run each service in its own terminal (frontend last):

```bash
cd users-api            # or products-api, orders-api, uploads-api, frontend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

The database-backed services read their connection settings from the environment
(defaults shown match the Docker command above):

```bash
export DB_HOST=localhost DB_USER=postgres DB_PASS=postgres
```

Then open <http://localhost:5000>.

## Configuration

All settings are environment variables.

| Variable | Used by | Default | Description |
|---|---|---|---|
| `DB_HOST` | users, products, orders | `localhost` | PostgreSQL host |
| `DB_PORT` | users, products, orders | `5432` | PostgreSQL port |
| `DB_NAME` | users, products, orders | `ecommerce` | Database name (tables don't clash, so services can share one DB) |
| `DB_USER` | users, products, orders | `postgres` | Database user |
| `DB_PASS` | users, products, orders | *(empty)* | Database password |
| `DB_POOL_MAX` | users, products, orders | `10` | Max pooled connections per process |
| `USERS_API` | orders, frontend | `http://localhost:5001` | Users service URL |
| `PRODUCTS_API` | orders, frontend | `http://localhost:5002` | Products service URL |
| `ORDERS_API` | frontend | `http://localhost:5003` | Orders service URL |
| `UPLOADS_API` | frontend | `http://localhost:5004` | Uploads service URL |
| `UPLOAD_DIR` | uploads | `./uploads` | Where images are stored locally |
| `MAX_UPLOAD_MB` | uploads | `5` | Maximum upload size |
| `S3_BUCKET` | uploads | *(unset)* | Store images in this S3 bucket instead of locally (standard AWS credentials apply; optional `AWS_REGION`) |
| `HOST` / `PORT` | all | `0.0.0.0` / service port | Bind address for `python app.py` |
| `FLASK_DEBUG` | all | `0` | Set to `1` for the Flask debugger |
| `LOG_LEVEL` | all | `INFO` | Python log level |

## API reference

All APIs return JSON; errors look like `{"error": "message"}`. Every service has
`GET /health` (the database-backed ones return `503` if the database is unreachable).

**users-api**
- `GET /users`, `GET /users/<id>`
- `POST /users` – `{"name": "Ada", "email": "ada@example.com"}` (`409` if the email exists)
- `DELETE /users/<id>`

**products-api**
- `GET /products`, `GET /products/<id>`
- `POST /products` – `{"name": "...", "price": 19.99, "description": "...", "image_url": "..."}` (description and image optional)
- `DELETE /products/<id>`

**orders-api**
- `POST /orders` – `{"user_id": 1, "items": [{"product_id": 101, "quantity": 2}]}`; `422` if the user or a product doesn't exist, `502` if a dependency is down
- `GET /orders?user_id=<id>`, `GET /orders/<id>`

**uploads-api**
- `POST /upload` – multipart form with a `file` field; the type is checked from the file contents, not the filename
- `GET /uploads/<filename>`

## Frontend

The storefront (`frontend/templates` + `frontend/static`) provides:

- Product catalogue with images, search, and a hero banner
- Cart (saved in the browser) with quantity controls and thumbnails
- Checkout as the selected user; create users from the **+ User** button
- **My orders** history
- **Manage** tab to add products (with image upload) and delete them
- Live health indicators for each backend service in the footer

Product images shipped with the app live in `frontend/static/images`. Seed products
reference them via `/static/images/...`; uploaded images are served through
`/api/uploads/<filename>`.

## Building images

Each service folder is its own Docker build context. Notes for your Dockerfiles:

- All services expose `app` in `app.py`, and `gunicorn` is in each `requirements.txt`
  (e.g. `gunicorn --bind 0.0.0.0:5001 app:app`).
- The `frontend` image must copy the `templates/` and `static/` folders as well as `app.py`.
- `uploads-api` needs a writable `UPLOAD_DIR` (mount a volume) unless `S3_BUCKET` is set.
- Inside a container network, point `DB_HOST` at your database container and set the
  `*_API` URLs to the service names.

## Contributing

- Open issues or pull requests with a descriptive title and steps to reproduce.

## License

- This project has no specified license. Add one if you intend to publish or share the code.
