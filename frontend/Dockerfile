ARG IMAGE_PATH
FROM ${IMAGE_PATH}node:20-alpine AS build
WORKDIR /app

ARG NPM_REGISTRY_URL
RUN npm config set registry ${NPM_REGISTRY_URL}
RUN npm config
COPY package.json package-lock.json .
RUN npm ci

COPY . .
ARG VITE_USE_MOCK
RUN echo "VITE_USE_MOCK=${VITE_USE_MOCK}" > .env
RUN npm run build

ARG IMAGE_PATH
FROM ${IMAGE_PATH}nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
