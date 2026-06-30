# Build stage — builds the module (and shared-lib) with the Maven wrapper.
FROM amazoncorretto:25 AS build
WORKDIR /workspace
COPY . .
RUN ./mvnw -q -pl user-service -am -DskipTests package

# Runtime stage
FROM amazoncorretto:25
WORKDIR /app
COPY --from=build /workspace/user-service/target/*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]
