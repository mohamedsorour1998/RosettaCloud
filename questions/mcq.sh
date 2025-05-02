#!/bin/bash

# Question Number: 2
# Question: What command is used to create a directory in Linux?
# Question Type: MCQ
# Question Difficulty: Easy
# Possible answers: 
# - answer_1: mkdir
# - answer_2: ls
# - answer_3: cat
# - answer_4: rm
# Correct answer: answer_1

# -q flag: Create a directory for testing
if [[ "$1" == "-q" ]]; then
  mkdir -p /home/ubuntu/test_directory
  echo "Directory created at /home/ubuntu/test_directory"
  exit 0
fi

# -c flag: Check if the directory exists
if [[ "$1" == "-c" ]]; then
  if [ -d "/home/ubuntu/test_directory" ]; then
    echo "Directory exists: /home/ubuntu/test_directory"
    exit 0
  else
    echo "Directory does not exist."
    exit 1
  fi
fi
