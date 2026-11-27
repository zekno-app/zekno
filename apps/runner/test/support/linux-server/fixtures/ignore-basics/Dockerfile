# The stages of check L17: three named, one unnamed, and the last the default.
ARG BASE=scratch

# The first stage, from an argument.
FROM ${BASE} AS base
COPY app.txt /app.txt

# Its files, from the first.
FROM base AS assets
COPY lib/ /lib/

FROM scratch
COPY --from=assets /lib /lib

# The default: the last stage.
FROM assets AS final
COPY README.txt /README.txt
