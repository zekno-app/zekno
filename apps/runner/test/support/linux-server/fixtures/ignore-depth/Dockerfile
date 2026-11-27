# Stage names in any case, and a heredoc whose lines are never instructions.
FROM scratch AS Base-Stage
COPY <<EOF /notes.txt
FROM scratch AS not-a-stage
EOF

FROM base-stage as second
COPY top.txt /top.txt

# The last stage, unnamed, is the default.
FROM second
