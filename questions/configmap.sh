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
    
    # Check if it's a ConfigMap
    if [[ "$content" != *"kind: ConfigMap"* ]]; then
      echo "Error: The manifest does not define a ConfigMap resource."
      exit 1
    fi
    
    # More precise check for the name using grep with word boundaries
    if ! grep -q "name:[ ]*app-config[ ]*$" "/home/coder/lab/app-config.yaml"; then
      echo "Error: The ConfigMap is not named 'app-config' as required."
      exit 1
    fi
    
    # Check for DATABASE_URL key
    if [[ "$content" != *"DATABASE_URL"* ]]; then
      echo "Error: The ConfigMap does not contain the 'DATABASE_URL' key."
      exit 1
    fi
    
    # Check for correct value using grep
    if ! grep -q "postgres://user:password@db:5432/app" "/home/coder/lab/app-config.yaml"; then
      echo "Error: The DATABASE_URL value is not set correctly."
      exit 1
    fi
    
    # If we reach here, all checks passed
    echo "ConfigMap manifest contains all required configuration."
    exit 0
  else
    echo "ConfigMap manifest does not exist at /home/coder/lab/app-config.yaml."
    exit 1
  fi
fi