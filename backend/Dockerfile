ARG IMAGE_PATH
FROM ${IMAGE_PATH}python:3.11.0-slim

# ODBC 드라이버 다운로드를 위한 ARG 선언 (RUN 명령 전에 필수)
ARG ODBC_DRIVER_URL
ARG ODBC_DRIVER_FILENAME

# 사내 debian repository 사용을 위해 sources.list 복사
COPY ./sources.list /etc/apt/sources.list
WORKDIR /app

# 환경 변수 설정
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Seoul \
    ODBCINI=/usr/local/odbc/odbc.ini \
    ODBCSYSINI=/usr/local/odbc \
    CLOUDERAIMPALAINI=/etc/cloudera.impalaodbc.ini

# mysqlclient C 확장 빌드 + cron 데몬 + wget (ODBC 설치용) + envsubst (템플릿 치환용) + curl (헬스체크용)
RUN apt-get update && apt-get install -y \
    gcc \
    pkg-config \
    default-libmysqlclient-dev \
    unixodbc \
    cron \
    wget \
    curl \
    libodbc1 \
    odbcinst \
    gettext \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# ODBC 설정 디렉토리 생성 및 Cloudera Impala ODBC 드라이버 설치
RUN mkdir -p /usr/local/odbc /opt/cloudera/impalaodbc/lib/64/en-US/ && \
    wget -q ${ODBC_DRIVER_URL} && \
    dpkg -i ${ODBC_DRIVER_FILENAME} && \
    rm -f ${ODBC_DRIVER_FILENAME} && \
    cp /opt/cloudera/impalaodbc/ErrorMessages/en-US/* /opt/cloudera/impalaodbc/lib/64/en-US/ && \
    rm -rf /tmp/* /var/tmp/*

# ODBC 설정 파일 템플릿 복사 및 환경변수 치환
COPY config/odbc/odbc.ini.template /tmp/odbc.ini.template
COPY config/odbc/odbcinst.ini /usr/local/odbc/odbcinst.ini
RUN envsubst < /tmp/odbc.ini.template > /usr/local/odbc/odbc.ini && \
    rm -f /tmp/odbc.ini.template


ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST
ARG BIGDATA_INDEX_URL
ARG BIGDATA_TRUSTED_HOST
ARG GUNICORN_PORT=8000
ARG GUNICORN_WORKERS=3
# ENV 로 컨테이너 실행 시점에 사용할 환경변수 설정
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
ENV BIGDATA_INDEX_URL=${BIGDATA_INDEX_URL}
ENV BIGDATA_TRUSTED_HOST=${BIGDATA_TRUSTED_HOST}
ENV ODBC_DRIVER_URL=${ODBC_DRIVER_URL}
ENV ODBC_DRIVER_FILENAME=${ODBC_DRIVER_FILENAME}
ENV GUNICORN_PORT=${GUNICORN_PORT}
ENV GUNICORN_WORKERS=${GUNICORN_WORKERS}
COPY requirements.txt .    
RUN pip install --no-cache-dir --index-url ${PIP_INDEX_URL} --trusted-host ${PIP_TRUSTED_HOST} -r requirements.txt

COPY . .
RUN mkdir -p /app/staticfiles /app/media
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && SKIP_SCHEDULER=true gunicorn config.wsgi:application --bind 0.0.0.0:${GUNICORN_PORT} --workers ${GUNICORN_WORKERS}"]
