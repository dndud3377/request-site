ARG IMAGE_PATH
FROM ${IMAGE_PATH}python:3.11.0-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y \
    gcc \
    pkg-config \
    default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*
ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
COPY requirements.txt .
RUN if [ -n "$PIP_INDEX_URL" ]; then \
        pip install --no-cache-dir --index-url ${PIP_INDEX_URL} --trusted-host ${PIP_TRUSTED_HOST} -r requirements.txt; \
    else \
        pip install --no-cache-dir -r requirements.txt; \
    fi
COPY . .
RUN mkdir -p /app/staticfiles /app/media
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
