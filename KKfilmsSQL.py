# Vul hier de naam van je programma in:
# kkmdb
#
# Vul hier jullie namen in:
# Kalle en Kimo
#
# Vul hier de naam van je programma in:
# KKfilms
#
# Vul hier jullie namen in:
# Kalle en Kimo


### --------- Bibliotheken en globale variabelen -----------------
import sqlite3
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
        PRIMARY KEY(Movie_id, Director_id)
        );""")
    print("Tabel 'tbl_movies' aangemaakt.")

def printTabel(tbl_roles): 
 cursor.execute("SELECT * FROM  tbl_roles") 
 opgehaalde_gegevens = cursor.fetchall() 
 print ( "Tabel" 'tbl_roles' ":", opgehaalde_gegevens)

def printTabel(tbl_actors): 
 cursor.execute("SELECT * FROM  tbl_actors") 
 opgehaalde_gegevens = cursor.fetchall() 
 print ( "Tabel" 'tbl_actors' ":", opgehaalde_gegevens)

def RolesGegevens():
    roles = [
    ("298","1524","Ellis Redding"),
    ("670","2965","Vincent Vega"),
    ("458","6143","Tyler Durden")
    ]
    cursor.executemany("INSERT INTO tbl_roles VALUES( ?, ?, ? )", roles)
    printTabel("tbl_roles")
db.commit()

def ActorGegevens():
    actors = [
    ("298","1937-06-01","Freeman","Morgan"),
    ("670","1954-02-18","Travolta","John"),
    ("458", "1963-12-18", "Pit", "Brad")
    ]
    cursor.executemany("INSERT INTO tbl_actors VALUES( ?, ?, ?, ? )", actors)
    printTabel("tbl_actors")
db.commit()

def DirectorGegevens():
    Directors = [
    ("1959-01-28","234","Shawshank redemption","Darabont", "Frank"),
    ("1963-03-27","589","Pulp Fiction","Tarantino", "Quentin"),
    ("1962-08-28", "401", "Fight club", "Fincher", "David")
    ]
    cursor.executemany("INSERT INTO tbl_directors VALUES( ?, ?, ?, ?, ? )", Directors)
    printTabel("tbl_directors")
db.commit()

def MovieGegevens():
    Directors = [
    ("234","1524","Drama","1994","9.5","Shawshank redemption"),
    ("589","2965","Crime","1994", "9", "Pulp Fiction"),
    ("401", "6143","Thriller", "1999", "8.9", "Fight club")
    ]
    cursor.executemany("INSERT INTO tbl_movies VALUES( ?, ?, ?, ?, ?, ? )", Directors)
    printTabel("tbl_movies")
db.commit()

def zoekMovie(ingevoerde_moviename):
    cursor.execute("SELECT * FROM tbl_movies WHERE Movie_name = ?", ( ingevoerde_moviename, ) )
    zoek_resultaat = cursor.fetchall()
    if zoek_resultaat == []: #resultaat is leeg, geen film gevonden
        print("Helaas, geen match gevonden met "+ ingevoerde_moviename)
    else:
        print("Film gevonden: ", zoek_resultaat )
    return zoek_resultaat


### --------- Hoofdprogramma  ---------------

maakNieuweTabellenAan()
printTabel("tbl_roles")
printTabel("tbl_actors")
RolesGegevens()
ActorGegevens()
DirectorGegevens()
zoekMovie()





