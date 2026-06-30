FROM amazoncorretto:25 AS build
WORKDIR /workspace
COPY . .
RUN ./mvnw -q -pl lab-service -am -DskipTests package

FROM amazoncorretto:25
WORKDIR /app
COPY --from=build /workspace/lab-service/target/*.jar app.jar
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "app.jar"]
