import setuptools

pkg_name = "pairio"

setuptools.setup(
    name=pkg_name,
    version="0.5.0",
    author="Jeremy Magland",
    author_email="jmagland@flatironinstitute.org",
    description="Key/value storage system",
    packages=setuptools.find_packages(),
    scripts=[],
    install_requires=[
        'requests', 'simplejson'
    ],
    classifiers=(
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
    )
)
