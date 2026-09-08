listA = [
    6,
    37,
    36,
    46,
    38,
    39,
    2,
    69,
    47,
    3,
    96,
    67,
    86,
    65,
    10,
    63,
    83,
    21,
    84,
    95,
    40,
    93,
    0,
    44,
    66
]

listB = [
    0,
    52,
    45,
    96,
    28,
    23,
    24,
    27,
    31,
    33,
    71,
    56,
    72,
    49,
    88,
    37,
    79,
    78,
    92,
    50,
    5,
    93,
    86,
    39,
    46
]

print(listA)
print(listB)

common_id = list(set(listA) & set(listB))
print(common_id)
