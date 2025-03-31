# Vul hier de naam van je programma in:
# KKfilms
#
# Vul hier jullie namen in:
# Kalle en Kimo


### --------- Bibliotheken en globale variabelen -----------------
import sqlite3

from MCPizzeriaSQL import printTabel
with sqlite3.connect("Kkfilms.db") as db:
    cursor = db.cursor()  #cursor is object waarmee je data uit de database kan halen

### ---------  Functie definities  -----------------
def maakNieuweTabellenAan ():
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_roles(
        Actor_id INTEGER NOT NULL,
        Movie_id INTEGER NOT NULL,
        Role_name TEXT NOT NULL,
        FOREIGN KEY (Actor_id) REFERENCES tbl_actors(Actor_id)
        FOREIGN KEY (Movie_id) REFERENCES tbl_movies(Movie_id)
        );""")
    print("Tabel 'tbl_roles' aangemaakt.")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_actors(
        Actor_id INTEGER PRIMARY KEY AUTOINCREMENT,
        Actor_birth INTEGER NOT NULL,
        Last_name TEXT NOT NULL,
        First_name TEXT NOT NUll);""")
    print("Tabel 'tbl_actors' aangemaakt.")
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_directors(
        Director_birth INTEGER NOT NULL,
        Director_id INTEGER NOT NULL,
        Top_movie TEXT NOT NULL,
        Last_name TEXT NOT NULL,
        First_name TEXT NOT NULL,
        FOREIGN KEY (Director_id) REFERENCES tbl_movies(Director_id)
        );""")
    print("Tabel 'tbl_directors' aangemaakt.")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_movies(
        Director_id INTEGER NOT NULL,
        Movie_id INTEGER NOT NULL,
        Genre TEXT NOT NULL,
        Year INTEGER,
        Rating REAL NOT NULL,
        Movie_name TEXT NOT NULL,
        PRIMARY KEY(Year, Director_id, rating, Movie_name)
        );""")
    print("Tabel 'tbl_movies' aangemaakt.")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_watchlist(
        Movie_name TEXT NOT NULL,
        Year INTEGER,
        Rating REAL NOT NULL,
        FOREIGN KEY (Year) REFERENCES tbl_movies(Year)
        FOREIGN KEY (Rating) REFERENCES tbl_movies(Rating)
        FOREIGN KEY (Movie_name) REFERENCES tbl_movies(Movie_name)
        );""")
    print("Tabel 'tbl_winkelWagen' aangemaakt.") 

def RolesGegevens():
    roles = [
        ("298", "1524", "Ellis Redding"),
        ("670", "2965", "Vincent Vega"),
        ("458", "6143", "Tyler Durden"),
        ("101", "1832", "Henry Hill"),
        ("102", "2001", "Michael Corleone"),
        ("103", "2401", "Jordan Belfort"),
        ("104", "2200", "Forrest Gump"),
        ("105", "3105", "Denzel Washington"),
        ("106", "2501", "Captain Jack Sparrow"),
        ("107", "2900", "Jason Bourne"),
        ("108", "3140", "Agent J"),
        ("109", "3430", "Indiana Jones"),
        ("110", "3302", "Blondie"),
        ("111", "3500", "Natasha Romanoff"),
        ("112", "3600", "Lara Croft"),
        ("113", "3700", "Miranda Priestly"),
        ("114", "3800", "Cheryl Strayed"),
        ("115", "3900", "Mona Lisa Vito"),
        ("116", "4000", "Freddie Quell"),
        ("117", "4100", "Bruce Wayne")
    ]
    cursor.executemany("INSERT INTO tbl_roles VALUES( ?, ?, ? )", roles)
db.commit()

def ActorGegevens():
    actors = [
        ("298", "1937-06-01", "Freeman", "Morgan"),
        ("670", "1954-02-18", "Travolta", "John"),
        ("458", "1963-12-18", "Pit", "Brad"),
        ("101", "1943-08-17", "De Niro", "Robert"),
        ("102", "1940-04-25", "Pacino", "Al"),
        ("103", "1974-11-11", "DiCaprio", "Leonardo"),
        ("104", "1956-07-09", "Hanks", "Tom"),
        ("105", "1954-12-28", "Washington", "Denzel"),
        ("106", "1963-06-09", "Depp", "Johnny"),
        ("107", "1970-10-08", "Damon", "Matt"),
        ("108", "1968-09-25", "Smith", "Will"),
        ("109", "1942-07-13", "Ford", "Harrison"),
        ("110", "1930-05-31", "Eastwood", "Clint"),
        ("111", "1984-11-22", "Johansson", "Scarlett"),
        ("112", "1975-06-04", "Jolie", "Angelina"),
        ("113", "1949-06-22", "Streep", "Meryl"),
        ("114", "1967-06-20", "Kidman", "Nicole"),
        ("115", "1967-10-28", "Roberts", "Julia"),
        ("116", "1974-10-28", "Phoenix", "Joaquin"),
        ("117", "1974-01-30", "Bale", "Christian")
    ]
    cursor.executemany("INSERT INTO tbl_actors VALUES( ?, ?, ?, ? )", actors)
db.commit()


def DirectorGegevens():
    Directors = [
        ("1959-01-28", "234", "Shawshank Redemption", "Darabont", "Frank"),
        ("1963-03-27", "589", "Pulp Fiction", "Tarantino", "Quentin"),
        ("1962-08-28", "401", "Fight Club", "Fincher", "David"),
        ("1946-12-18", "118", "Jurassic Park", "Spielberg", "Steven"),
        ("1970-07-30", "119", "Inception", "Nolan", "Christopher"),
        ("1942-11-17", "120", "Goodfellas", "Scorsese", "Martin"),
        ("1937-11-30", "121", "Gladiator", "Scott", "Ridley"),
        ("1954-08-16", "122", "Titanic", "Cameron", "James"),
        ("1961-10-31", "123", "The Lord of the Rings: The Return of the King", "Jackson", "Peter"),
        ("1928-07-26", "124", "The Shining", "Kubrick", "Stanley"),
        ("1946-01-20", "125", "Mulholland Drive", "Lynch", "David"),
        ("1969-05-01", "126", "The Grand Budapest Hotel", "Anderson", "Wes"),
        ("1954-11-29", "127", "No Country for Old Men", "Coen", "Joel"),
        ("1957-09-21", "128", "Fargo", "Coen", "Ethan"),
        ("1968-09-10", "129", "Snatch", "Ritchie", "Guy"),
        ("1962-09-17", "130", "Moulin Rouge!", "Luhrmann", "Baz"),
        ("1929-01-03", "131", "The Good, the Bad and the Ugly", "Leone", "Sergio"),
        ("1939-04-07", "132", "The Godfather", "Coppola", "Francis"),
        ("1933-08-18", "133", "The Pianist", "Polanski", "Roman"),
        ("1957-03-20", "134", "Do the Right Thing", "Lee", "Spike")
    ]
    cursor.executemany("INSERT INTO tbl_directors VALUES( ?, ?, ?, ?, ? )", Directors)
db.commit()


def MovieGegevens():
    movies = [
        ("234", "1524", "Drama",    "1994", "9.5", "Shawshank Redemption"),
        ("589", "2965", "Crime",    "1994", "9",   "Pulp Fiction"),
        ("401", "6143", "Thriller", "1999", "8.9", "Fight Club"),
        ("118", "1832", "Adventure","1993", "8.1", "Jurassic Park"),
        ("119", "2001", "Sci-Fi",   "2010", "8.8", "Inception"),
        ("120", "3105", "Crime",    "1990", "8.7", "Goodfellas"),
        ("121", "2201", "Action",   "2000", "8.5", "Gladiator"),
        ("122", "2750", "Romance",  "1997", "7.8", "Titanic"),
        ("123", "3302", "Fantasy",  "2003", "8.8", "The Lord of the Rings: The Return of the King"),
        ("124", "4105", "Horror",   "1980", "8.4", "The Shining"),
        ("125", "1500", "Mystery",  "2001", "7.9", "Mulholland Drive"),
        ("126", "2601", "Comedy",   "2014", "8.1", "The Grand Budapest Hotel"),
        ("127", "3401", "Crime",    "2007", "8.1", "No Country for Old Men"),
        ("128", "1905", "Crime",    "1996", "8.1", "Fargo"),
        ("129", "2103", "Action",   "2000", "8.3", "Snatch"),
        ("130", "2500", "Musical",  "2001", "7.6", "Moulin Rouge!"),
        ("131", "3000", "Western",  "1966", "8.8", "The Good, the Bad and the Ugly"),
        ("132", "4001", "Crime",    "1972", "9.2", "The Godfather"),
        ("133", "4502", "Biography","2002", "8.5", "The Pianist"),
        ("134", "4800", "Drama",    "1989", "8.0", "Do the Right Thing")
    ]
    cursor.executemany("INSERT INTO tbl_movies VALUES( ?, ?, ?, ?, ?, ? )", movies)
db.commit()


def printTabel(tabel_naam):
    cursor.execute("SELECT * FROM " + tabel_naam) #SQL om ALLE gegevens te halen
    opgehaalde_gegevens = cursor.fetchall() #sla gegevens op in een variabele
    print("Tabel " + tabel_naam + ":", opgehaalde_gegevens) #druk gegevens af

def vraagOpGegevensMovietabel():
    cursor.execute("SELECT * FROM tbl_movies")
    resultaat = cursor.fetchall()
    print("Tabel tbl_movies:", resultaat)
    return resultaat

def vraagOpGegevensActortabel():
    cursor.execute("SELECT * FROM tbl_actors")
    resultaat = cursor.fetchall()
    print("Tabel tbl_actors:", resultaat)
    return resultaat

def zoekMovie(ingevoerde_moviename):
    cursor.execute("SELECT * FROM tbl_movies WHERE Movie_name = ?", ( ingevoerde_moviename, ) )
    zoek_resultaat = cursor.fetchall()
    if zoek_resultaat == []: #resultaat is leeg, geen film gevonden
        print("Helaas, geen match gevonden met "+ ingevoerde_moviename)
    else:
        print("Film gevonden: ", zoek_resultaat )
    return zoek_resultaat

def zoekactor(ingevoerde_acteurs):
    cursor.execute("SELECT * FROM tbl_actors WHERE Last_name = ?", ( ingevoerde_acteurs, ) )
    zoek_resultaat = cursor.fetchall()
    if zoek_resultaat == []: #resultaat is leeg, geen film gevonden
        print("Helaas, geen match gevonden met "+ ingevoerde_acteurs)
    else:
        print("Acteur gevonden: ", zoek_resultaat )
    return zoek_resultaat

def voegToeAanWatchlist(Movie_name, Year, Rating):
    cursor.execute("INSERT INTO tbl_watchlist VALUES( ?, ?, ?)", (Movie_name, Year, Rating,))
    db.commit() 
    printTabel("tbl_watchlist")

def vraagOpGegevensWatchlist():
    cursor.execute("SELECT * FROM tbl_watchlist")
    resultaat = cursor.fetchall()
    print("Tabel tbl_watchlist:", resultaat)
    return resultaat


### --------- Hoofdprogramma  ---------------

maakNieuweTabellenAan()
RolesGegevens()
ActorGegevens()
DirectorGegevens()
MovieGegevens()
vraagOpGegevensMovietabel()
vraagOpGegevensActortabel()
zoekMovie("Pulp Fiction")
zoekactor ("Pit")