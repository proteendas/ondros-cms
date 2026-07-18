FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Shell form so $PORT expands — hosts like Render inject PORT and require the
# container to bind to it; falls back to 8000 for plain `docker run`/local use.
# --reload is dev-only; docker-compose.yml overrides `command:` to add it back
# (paired with the volume mount there). This default CMD is the production path.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
