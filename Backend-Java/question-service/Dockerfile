FROM amazoncorretto:25 AS build
WORKDIR /workspace
COPY . .
RUN ./mvnw -q -pl question-service -am -DskipTests package

FROM amazoncorretto:25
WORKDIR /app
COPY --from=build /workspace/question-service/target/*.jar app.jar
EXPOSE 8083
ENTRYPOINT ["java", "-jar", "app.jar"]
