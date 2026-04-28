# Reflection

## Project Description

ScriptDeck is a React single-page application for organizing and exploring film-analysis projects. The app starts with a movie dataset from `src/movies.json`, then lets the user manage additional project data entirely in the browser. The project is organized with the following MVC structure:

- Model: `src/models/movies.js` handles normalization, selectors, sorting, filtering, and persistence.
- Controller: route pages in `src/pages/` coordinate user interactions and pass data into views.
- View: reusable UI components in `src/components/` render the interface.

## What Functionality This App Offers

- View a recent-projects section with quick access into the library on the Explore page.
- Search projects by title, director, writer, cinematographer, rating, or genre.
- Filter projects by director, cinematographer, writer, genre, and rating.
- Sort projects by title, release date, or recently updated.
- Create new project entries through a form-based workflow.
- Edit existing project entries from the My Projects page.
- Delete project entries from the My Projects page.
- Upload a custom cover image for a project.
- Open a project detail modal to view metadata and external resource links.
- Persist project changes in browser `localStorage` so the app stays usable without a backend.

## Material UI Components Used

The app uses the following Material UI components:

- `TextField`
- `Button`
- `MenuItem`
- `FormControl`
- `Select`

The app also uses these Material UI icons:

- `SearchIcon`
- `CloudUploadOutlinedIcon`
- `ChevronRightRoundedIcon`

## React Hooks Used

The app uses these React and router hooks:

- `useState`
- `useEffect`
- `useNavigate`
- `useSearchParams`
- `useLocation`

There is also one custom hook:

- `useMoviesStore`

`useMoviesStore` is responsible for loading the project list, exposing CRUD actions, and syncing updates back to `localStorage`.

## How I Used Generative AI During Development

I used generative AI as a development assistant during the project. It helped me brainstorm UI structure, refactor the codebase into a clearer architecture, and work through implementation details such as shared state flow, local persistence, search/filter logic, and reusable component organization. I also used it to review wording and improve inline documentation. Final decisions, testing, and code adjustments were still reviewed and made by me in the project itself. 

The specific tool used was Codex's VScode extension, which was prompted to generate the code in this file - all architectural choices and strategy such as where state should live, how to use hooks, etc. were over seen and chosen by me. I also decided any other design considerations such as which components, MUI resources, and layout configuratiosn to use and gave very clear constraints to Codex to ensure the generated code matched the scope and intention of this project. All code had been read, reviewed and refactored by me personally. Using Codex allowed me to focus more on the final product and the architecture than the specific implementation details - which was helpful because I was able to set more ambitious goals for the final deliverable project. 


## Most Challenging Part

The most challenging part of the assignment was coordinating the provided dataset in the .json file with any edits to the project state, and the multi-page UI in sync without using a backend. Because `movies.json` is static at runtime, I could not treat it as the live writable data source. I solved this by treating `movies.json` as the starter layer and using `localStorage` as the persistent writable layer. The `src/models/movies.js` file normalizes both sources into one consistent shape, and `useMoviesStore` shares that state with the route pages so Explore, My Projects, and Create Project all stay in sync.

Another challenge was keeping the codebase understandable as the app grew, especially since I was using Codex throughout the process. I addressed this by splitting responsibilities across the model, page controller, and reusable view layers, rather than letting logic spread randomly across components.

The biggest issue is how images are currently displayed in the expanded project card; I ran out of time and was mostly experimenting with this behavior because I plan to incorporate some of these user interface ideas into a larger full-stack project for my personal portfolio.

## How to Run the Project

1. Open a terminal in the unzipped project folder.
2. Run `cd client`.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open the local Vite URL shown in the terminal, usually `http://localhost:5173/`.

## Additional Notes

- This is a frontend-only React app, so project changes are stored in browser `localStorage`.
- If you want to reset the app back to the original dataset, clear the `scriptdeck.movies` key in local storage and refresh the page.
- Uploaded cover images are stored in the browser as part of each saved project entry.
