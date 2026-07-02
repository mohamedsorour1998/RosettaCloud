FROM amazoncorretto:25 AS build
# mvnw unpacks the Maven distribution with tar/gzip; the minimal Corretto image ships neither.
RUN yum install -y tar gzip || microdnf install -y tar gzip
WORKDIR /workspace
COPY . .
RUN ./mvnw -q -pl lab-service -am -DskipTests package

FROM amazoncorretto:25
# --- hardening: run as a non-root user (uid/gid 1000) ---
# amazoncorretto:25 is Amazon Linux 2023-based and ships shadow-utils (groupadd/useradd).
# The install line is a no-op on the full base; it's a safety net if a future base is minimal.
RUN yum install -y shadow-utils >/dev/null 2>&1 || microdnf install -y shadow-utils >/dev/null 2>&1 || true
RUN groupadd --system --gid 1000 spring \
 && useradd  --system --uid 1000 --gid 1000 --home-dir /app --no-create-home --shell /sbin/nologin spring
WORKDIR /app
COPY --from=build /workspace/lab-service/target/*.jar app.jar
# jar stays root-owned and world-readable (Maven emits 0644); the non-root user only needs read.
USER 1000:1000
EXPOSE 8082
# PerfDisableSharedMem drops the /tmp/hsperfdata dependency; java.io.tmpdir=/tmp targets the
# writable emptyDir mounted when readOnlyRootFilesystem=true.
ENTRYPOINT ["java", "-XX:+PerfDisableSharedMem", "-Djava.io.tmpdir=/tmp", "-jar", "app.jar"]
