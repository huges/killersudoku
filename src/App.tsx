import './styles/app.css'

function App() {
  return (
    <main className="page-shell">
      <section className="baseline-card" aria-labelledby="page-title">
        <p className="eyebrow">Baseline iniziale</p>
        <h1 id="page-title">Killer Sudoku</h1>
        <p className="intro">
          Una base visiva per il prossimo incremento del gioco. La schermata è
          volutamente non giocabile: griglia, gabbie e controlli saranno
          introdotti in una fase successiva.
        </p>
        <div className="status-note" role="status">
          <span className="status-dot" aria-hidden="true" />
          Preparazione dell’esperienza di gioco
        </div>
      </section>
    </main>
  )
}

export default App
