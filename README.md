# primex
Visually explore the set of prime numbers via their binary representations mapped to images

# Scheme

Define a square image with height and width 2^N. Partition into squares, each representing an integer >= 2. 2 takes the bottom left quarter of the image, 3 takes the bottom right. So 2,3 form a row of height 2^N/2. Fill the square if the number is prime. The next row up has height 2^N/4 and represents 4,5,6,7. Continue upward, halving the row height each time, until you've filled a row with height=1. The image should have one final row of a single pixel; those pixels can be filled with a color for the average density of primes in that pixel, or just left blank.

The basic invariant is that each square representing i has two half-height squares above it, representing 2*i and 2*i+1.

# Navigation

Explore by touching part of the image. If you touch the upper left quadrant, the view zooms in so that the bottom row (was 2,3) is now (4,5) and the row above is (8,9,10,11), so we are viewing a subset of the integers. Or you could zoom into (6,7) (12,13,14,15). Touch the lower half of the image to zoom out. Touch near the sides of the image to pan left or right, if that is possible.

# App

The app is written in typescript and compiled down into a single html file for deployment.