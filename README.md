# primex
Visually explore the set of prime numbers via their binary representations mapped to images

[Try it](https://tulrich.github.io/primex/)

The black squares are primes. Drag the image to explore different portions of the integer set. Touch a prime to highlight it and see its numeric value below.

The current view is propagated to the URL in case you want to share a view. No state is saved server side and no cookies are used.

## Code

Written in TypeScript and compiled down to a single HTML file.

(https://github.com/tulrich/primex)[GitHub link]

## Scheme

Define a square image with height and width 2^N. Partition into squares, each representing an integer >= 2. 2 takes the bottom left quarter of the image, 3 takes the bottom right. So 2,3 form a row of height 2^N/2. Fill the square if the number is prime. The next row up has height 2^N/4 and represents 4,5,6,7. Continue upward, halving the row height each time, until you've filled a row with height=1. The image should have one final row of a single pixel; those pixels can be filled with a color for the average density of primes in that pixel, or just left blank.

The basic invariant is that each square representing i has two half-height squares above it, representing 2*i and 2*i+1.
