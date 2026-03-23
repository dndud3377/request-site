ARG IMAGE_PATH
FROM ${IMAGE_PATH}node:20-alpine AS build
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN npm run build
ARG IMAGE_PATH
FROM ${IMAGE_PATH}nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx-frontend.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
