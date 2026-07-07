package main

deny contains msg if {
	input.password
	msg := "plaintext password field detected"
}

deny contains msg if {
	input.api_key
	msg := "plaintext api_key field detected"
}

deny contains msg if {
	input.secret
	msg := "plaintext secret field detected"
}
