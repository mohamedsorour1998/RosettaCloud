#!/bin/bash

# Question Number: 4
# Question: Create a Kubernetes ConfigMap manifest at /home/coder/lab/app-config.yaml that defines a ConfigMap named "app-config" in the default namespace with a key "DATABASE_URL" set to "postgres://user:password@db:5432/app".
# Question Type: Check
# Question Difficulty: Medium

# -q flag: Create the directory if it doesn't exist
if [[ "$1" == "-q" ]]; then
  echo "Creating directory if needed..."
  mkdir -p /home/coder/lab
  exit 0
fi

# -c flag: Check if the ConfigMap manifest exists with the correct data
if [[ "$1" == "-c" ]]; then
  # Check if file exists
  if [ -f "/home/coder/lab/app-config.yaml" ]; then
    content=$(cat /home/coder/lab/app-config.yaml)
    
    # Check for essential parts of a ConfigMap
    if [[ "$content" == *"kind: ConfigMap"* && 
          "$content" == *"name: app-config"* && 
          "$content" == *"DATABASE_URL"* && 
          "$content" == *"postgres://user:password@db:5432/app"* ]]; then
      echo "ConfigMap manifest contains required configuration."
      exit 0
    else
      echo "ConfigMap manifest exists but does not contain all required configuration."
      exit 1
    fi
  else
    echo "ConfigMap manifest does not exist at /home/coder/lab/app-config.yaml."
    exit 1
  fi
fi