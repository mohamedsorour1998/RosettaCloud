#!/bin/bash

# Question Number: 1
# Question: Create a directory at /home/ubuntu named my_new_directory.
# Question Type: Check
# Question Difficulty: Medium

# -q flag: Create the directory
if [[ "$1" == "-q" ]]; then
    echo "No setup required for this Check."
  exit 0
fi

# -c flag: Check if the directory exists
if [[ "$1" == "-c" ]]; then
  if [ -d "/home/ubuntu/my_new_directory" ]; then
    echo "Directory exists: /home/ubuntu/my_new_directory"
    exit 0
  else
    echo "Directory does not exist."
    exit 1
  fi
fi
