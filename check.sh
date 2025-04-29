#!/bin/bash

# Question Number: 1
# Question: Create a directory at /home/ubuntu
# Question Type: Check
# Question Difficulty: Medium

# -q flag: Create the directory
if [[ "$1" == "-q" ]]; then
  mkdir -p /home/ubuntu/my_new_directory
  echo "Directory created at /home/ubuntu/my_new_directory"
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
