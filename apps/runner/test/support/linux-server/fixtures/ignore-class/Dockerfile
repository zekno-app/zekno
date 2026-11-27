# Two stages, the second named with a digit and a dash.
FROM scratch AS stage1
COPY top.txt /top.txt

FROM stage1 AS stage-2
COPY keep.md /keep.md
