FROM amazoncorretto:25 AS build
# mvnw unpacks the Maven distribution with tar/gzip; the minimal Corretto image ships neither.
RUN yum install -y tar gzip || microdnf install -y tar gzip
WORKDIR /workspace
COPY . .
RUN ./mvnw -q -pl chat-service -am -DskipTests package

FROM amazoncorretto:25
WORKDIR /app
COPY --from=build /workspace/chat-service/target/*.jar app.jar
EXPOSE 8084
ENTRYPOINT ["java", "-jar", "app.jar"]
