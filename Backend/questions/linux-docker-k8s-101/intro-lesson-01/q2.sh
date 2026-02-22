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

# -q flag: no setup needed
if [[ "$1" == "-q" ]]; then
  echo "No setup required for this MCQ."
  exit 0
fi

# -c flag: always succeed
if [[ "$1" == "-c" ]]; then
  echo "Nothing to verify for this MCQ."
  exit 0
fi
