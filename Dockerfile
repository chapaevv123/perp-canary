FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY web ./web
COPY docs/evidence/verified-delegated-btc-order.json ./docs/evidence/verified-delegated-btc-order.json
COPY canary-proofs/canary-proof-1793098877887-4230656d134c.json ./canary-proofs/canary-proof-1793098877887-4230656d134c.json
RUN mkdir -p evidence trade-evidence
ENV CANARY_PORT=8080
ENV CANARY_HOST=0.0.0.0
ENV CANARY_PUBLIC_ENABLED=1
EXPOSE 8080
CMD ["npm", "run", "serve"]
