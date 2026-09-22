FROM node:24-alpine@sha256:333f6b3eca25980d5682c26207665b93c9417786b21760b2764d5821d9704c8a

COPY packs /packs
COPY fixtures /fixtures-src
COPY image/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
 && /entrypoint.sh --bake-all \
 && rm -rf /fixtures-src /packs

ENTRYPOINT ["/entrypoint.sh"]
