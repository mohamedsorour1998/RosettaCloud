# Lightweight stand-in for the real interactive-labs pod in CI: serves :80 (readiness) and has
# bash + coreutils (base64) so question-service can exec the -q/-c blocks. The heavy DinD+Kind
# image is infeasible on a 2-vCPU runner and is validated separately on a full cluster.
FROM python:3.12-slim
RUN mkdir -p /home/coder/lab
WORKDIR /home/coder/lab
EXPOSE 80
CMD ["python3", "-m", "http.server", "80"]
