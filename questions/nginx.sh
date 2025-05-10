#!/bin/bash

# Question Number: 3
# Question: Create a Docker container running nginx and expose it on port 8080 of the host machine. The container should be named "nginx-test" and store its logs in /home/coder/lab/nginx-logs.
# Question Type: Check
# Question Difficulty: Medium

# -q flag: Clean up any existing container with the same name and create the log directory
if [[ "$1" == "-q" ]]; then
  echo "Cleaning up any existing nginx-test container..."
  docker rm -f nginx-test 2>/dev/null
  mkdir -p /home/coder/lab/nginx-logs
  exit 0
fi

# -c flag: Check if the container is running and exposing port 8080
if [[ "$1" == "-c" ]]; then
  # Check if container exists and is running
  if docker ps | grep -q "nginx-test"; then
    # Check if port 8080 is mapped
    port_mapping=$(docker port nginx-test)
    # Check if the volume is mounted correctly
    volume_mapping=$(docker inspect nginx-test --format='{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}')
    
    if [[ "$port_mapping" == *"8080"* && "$port_mapping" == *"80"* && 
          "$volume_mapping" == *"/home/coder/lab/nginx-logs"* ]]; then
      echo "Container 'nginx-test' is running with correct port and volume mapping."
      exit 0
    else
      echo "Container 'nginx-test' is running but configuration is incorrect."
      exit 1
    fi
  else
    echo "Container 'nginx-test' is not running."
    exit 1
  fi
fi