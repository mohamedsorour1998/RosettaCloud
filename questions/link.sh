#!/bin/bash

# Question Number: 3
# Question: Create a symbolic link /home/ubuntu/logs pointing to /var/log
# Question Type: Check
# Question Difficulty: Medium

LINK_PATH="/home/ubuntu/logs"
TARGET="/var/log"

# -q flag: create the symlink (replace if wrong)
if [[ "$1" == "-q" ]]; then
  ln -snf "/var/log" "/home/ubuntu/logs"
  echo "Symlink created: /home/ubuntu/logs -> $/var/log"
  exit 0
fi

# -c flag: verify the symlink exists and targets /var/log
if [[ "$1" == "-c" ]]; then
  if [[ -L "/home/ubuntu/logs" && "$(readlink -f "/home/ubuntu/logs")" == "/var/log" ]]; then
    echo "Symlink is correct."
    exit 0
  else
    echo "Symlink is missing or incorrect."
    exit 1
  fi
fi
