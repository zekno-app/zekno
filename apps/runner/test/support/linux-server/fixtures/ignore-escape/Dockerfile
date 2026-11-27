# escape=`

# The escape character is a backtick: a continuation ends with it.
FROM scratch AS one
COPY a.txt `
     /a.txt

FROM one AS two
COPY b.txt `
# a comment line inside a continuation is dropped
     /b.txt

FROM two AS three
