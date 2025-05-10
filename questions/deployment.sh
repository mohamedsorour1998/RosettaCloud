#!/bin/bash

# Question Number: 5
# Question: Create a Kubernetes deployment manifest file at /home/coder/lab/nginx-deployment.yaml that deploys 3 replicas of the nginx:latest image.
# Question Type: Check
# Question Difficulty: Medium

# -q flag: Create the directory if it doesn't exist
if [[ "$1" == "-q" ]]; then
  echo "Creating directory if needed..."
  mkdir -p /home/coder/lab
  exit 0
fi

# -c flag: Check if the file exists and has the correct content
if [[ "$1" == "-c" ]]; then
  if [ -f "/home/coder/lab/nginx-deployment.yaml" ]; then
    # Check for essential parts of a deployment with 3 replicas of nginx
    content=$(cat /home/coder/lab/nginx-deployment.yaml)
    if [[ "$content" == *"kind: Deployment"* && 
          "$content" == *"replicas: 3"* && 
          "$content" == *"image: nginx"* ]]; then
      echo "Deployment manifest contains required configuration."
      exit 0
    else
      echo "Deployment manifest exists but does not contain all required configuration."
      exit 1
    fi
  else
    echo "Deployment manifest does not exist at /home/coder/lab/nginx-deployment.yaml."
    exit 1
  fi
fi