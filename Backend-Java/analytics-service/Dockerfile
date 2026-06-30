FROM amazoncorretto:25 AS build
WORKDIR /workspace
COPY . .
RUN ./mvnw -q -pl analytics-service -am -DskipTests package

FROM amazoncorretto:25
WORKDIR /app
COPY --from=build /workspace/analytics-service/target/*.jar app.jar
EXPOSE 8085
ENTRYPOINT ["java", "-jar", "app.jar"]
