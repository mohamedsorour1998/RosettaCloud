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
    # Check for essential parts of a deployment with 3 replicas of nginx:latest
    content=$(cat /home/coder/lab/nginx-deployment.yaml)
    
    # Check if it's a Deployment
    if [[ "$content" != *"kind: Deployment"* ]]; then
      echo "Error: The manifest does not define a Deployment resource."
      exit 1
    fi
    
    # Check if it has 3 replicas
    if [[ "$content" != *"replicas: 3"* ]]; then
      echo "Error: The deployment does not specify 3 replicas."
      exit 1
    fi
    
    # Check for nginx:latest image (accepting both formats)
    if [[ "$content" != *"image: nginx:latest"* ]]; then
      echo "Error: The deployment does not use the nginx or nginx:latest image."
      exit 1
    fi
    
    # If we reach here, all checks passed
    echo "Deployment manifest contains all required configuration."
    exit 0
  else
    echo "Deployment manifest does not exist at /home/coder/lab/nginx-deployment.yaml."
    exit 1
  fi
fi