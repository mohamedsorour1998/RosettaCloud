FROM amazoncorretto:25 AS build
WORKDIR /workspace
COPY . .
RUN ./mvnw -q -pl chat-service -am -DskipTests package

FROM amazoncorretto:25
WORKDIR /app
COPY --from=build /workspace/chat-service/target/*.jar app.jar
EXPOSE 8084
ENTRYPOINT ["java", "-jar", "app.jar"]
