"""Frontend: serves the storefront UI and proxies API calls to the backend services.

Proxying through Flask means the browser only talks to one origin, so no CORS
configuration is needed and the backend services stay on the internal network.
"""
import logging
import os
from concurrent.futures import ThreadPoolExecutor

import requests
from flask import Flask, Response, jsonify, render_template, request

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("frontend")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024  # a little above the uploads limit

SERVICES = {
    "users": os.environ.get("USERS_API", "http://localhost:5001").rstrip("/"),
    "products": os.environ.get("PRODUCTS_API", "http://localhost:5002").rstrip("/"),
    "orders": os.environ.get("ORDERS_API", "http://localhost:5003").rstrip("/"),
    "uploads": os.environ.get("UPLOADS_API", "http://localhost:5004").rstrip("/"),
}
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT", "10"))
STATUS_TIMEOUT = float(os.environ.get("STATUS_TIMEOUT", "2"))


def proxy(service, path, timeout=None):
    """Forward the current request to a backend service and relay its response."""
    kwargs = {
        "params": request.args.to_dict(flat=False),
        "timeout": timeout or HTTP_TIMEOUT,
    }
    if request.files:
        kwargs["files"] = {
            field: (f.filename, f.stream, f.mimetype) for field, f in request.files.items()
        }
        kwargs["data"] = request.form.to_dict(flat=False)
    elif request.method in ("POST", "PUT", "PATCH"):
        kwargs["data"] = request.get_data()
        kwargs["headers"] = {"Content-Type": request.content_type or "application/json"}

    try:
        upstream = requests.request(request.method, f"{SERVICES[service]}{path}", **kwargs)
    except requests.RequestException as exc:
        logger.warning("%s service request failed: %s", service, exc)
        return jsonify(error=f"The {service} service is unavailable"), 502

    response = Response(upstream.content, status=upstream.status_code)
    response.headers["Content-Type"] = upstream.headers.get("Content-Type", "application/json")
    if service == "uploads" and request.method == "GET" and upstream.ok:
        response.headers["Cache-Control"] = "public, max-age=86400"  # names are immutable
    return response


def check_service(item):
    name, base_url = item
    try:
        return name, requests.get(f"{base_url}/health", timeout=STATUS_TIMEOUT).ok
    except requests.RequestException:
        return name, False


@app.get("/")
def index():
    return render_template("index.html", services=SERVICES)


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.get("/api/status")
def api_status():
    with ThreadPoolExecutor(max_workers=len(SERVICES)) as pool:
        return jsonify(dict(pool.map(check_service, SERVICES.items())))


@app.route("/api/users", methods=["GET", "POST"])
def api_users():
    return proxy("users", "/users")


@app.route("/api/products", methods=["GET", "POST"])
def api_products():
    return proxy("products", "/products")


@app.route("/api/products/<int:product_id>", methods=["GET", "DELETE"])
def api_product(product_id):
    return proxy("products", f"/products/{product_id}")


@app.route("/api/orders", methods=["GET", "POST"])
def api_orders():
    return proxy("orders", "/orders")


@app.post("/api/upload")
def api_upload():
    return proxy("uploads", "/upload", timeout=30)


@app.get("/api/uploads/<filename>")
def api_uploaded_file(filename):
    return proxy("uploads", f"/uploads/{filename}", timeout=30)


@app.errorhandler(413)
def too_large(_err):
    return jsonify(error="Upload is too large"), 413


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
