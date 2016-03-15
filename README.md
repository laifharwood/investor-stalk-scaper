This is a little Node.js script I wrote for the Southern Utah Code Camp.  When deployed, this script periodically checks the Securities and Exchange Commission website for new "Beneficial Ownership" filings and parses the html for certain data and writes it to a OrientDB document/graph database.

This script goes with my other repository which is an IOS app: https://bitbucket.org/laifharwood/investorstalk-ios

If I were to ever continue on this script, the first things I would do is organize and refactor the code into different modules and add more data validation before writing to the database.