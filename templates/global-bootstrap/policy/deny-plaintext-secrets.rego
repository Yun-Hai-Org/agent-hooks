package main

deny[msg] {
  input.password
  msg := "plaintext password field detected"
}

deny[msg] {
  input.api_key
  msg := "plaintext api_key field detected"
}

deny[msg] {
  input.secret
  msg := "plaintext secret field detected"
}
