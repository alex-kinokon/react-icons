import { useEffect, useMemo, useState } from "react";
import { css, cx } from "@emotion/css";
import { Link, useLocation, useRoute } from "wouter";
import Fuse from "fuse.js";
import { useDebouncedEffect } from "@react-hookz/web";
import { type IconDefinition, icons as iconDefs } from "./data";
import { Icon, type IconTree } from "../../src";

interface IconEntry {
  name: string;
  icon: IconTree;
  package: string;
}

function getIcons(id: string) {
  return import(`../../dist/icons/${id}.js`) as Promise<Record<string, IconTree>>;
}

function App() {
  const [, setLocation] = useLocation();

  const [inIconList, selectedIconList] = useRoute("/icons/:id");
  const [, searchParam] = useRoute("/search/:search");
  const selectedIcon =
    inIconList && iconDefs.find(icon => icon.id === selectedIconList?.id);

  const [fuse, setFuse] = useState<Fuse<IconEntry>>();

  const search = searchParam?.search;
  const [searchText, setSearchText] = useState(search);

  useDebouncedEffect(
    () => {
      if (searchText) {
        setLocation(`/search/${searchText}`);
      }
    },
    [searchText],
    500
  );

  const filteredIcons = useMemo(
    () =>
      fuse && search && search.length > 3
        ? fuse.search(search.replaceAll("%20", " ")).map(({ item }) => item)
        : null,
    [fuse, search]
  );

  useEffect(() => {
    async function load() {
      const list: IconEntry[] = [];
      for (const { id } of iconDefs) {
        const module = await getIcons(id);
        list.push(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          ...(Object.entries(module) as [string, IconTree][]).map(
            ([name, tree]): IconEntry => ({ name, icon: tree, package: id })
          )
        );
      }

      const f = new Fuse(list, {
        keys: ["name", "package"],
        threshold: 0.2,
      });
      setFuse(f);
    }

    void load();
  }, []);

  return (
    <div
      className={css`
        display: grid;
        grid-template-columns: 300px 1fr;
      `}
    >
      <nav
        className={css`
          margin: 10px 30px;
        `}
      >
        <h1
          className={css`
            margin: 0;
          `}
        >
          react-icons
        </h1>

        <div
          className={css`
            margin: 10px 0;
          `}
        >
          <input
            type="search"
            value={searchText}
            onChange={event => setSearchText(event.currentTarget.value)}
            className={css`
              width: 100%;
            `}
          />
        </div>
        <ul
          className={css`
            margin: 0;
            padding: 0;
            list-style: none;
          `}
        >
          {iconDefs.map(icon => (
            <li
              key={icon.id}
              className={
                icon.id === selectedIconList?.id
                  ? css`
                      font-weight: bold;
                    `
                  : ""
              }
            >
              <Link href={`/icons/${icon.id}`}>{icon.name}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        {search && filteredIcons ? (
          <SearchPage search={search} icons={filteredIcons} />
        ) : selectedIcon ? (
          <IconPage icons={selectedIcon} />
        ) : (
          <div
            className={css`
              margin: 30px;
            `}
          >
            <a href="https://www.npmjs.com/package/react-icons">React Icons</a>
          </div>
        )}
      </div>
    </div>
  );
}

function IconPage({ icons }: { icons: IconDefinition }) {
  const [list, setList] = useState<IconEntry[]>([]);

  useEffect(() => {
    void getIcons(icons.id).then(module =>
      setList(
        Object.entries(module).map(([name, icon]) => ({ name, icon, package: icons.id }))
      )
    );
  }, [icons.id]);

  return (
    <div>
      <h1>{icons.name}</h1>
      <table>
        <tbody>
          <tr>
            <th>License</th>
            <td>
              <a href={icons.licenseUrl}>{icons.license}</a>
            </td>
          </tr>
          <tr>
            <th>Project</th>
            <td>
              <a href={icons.projectUrl}>{icons.projectUrl}</a>
            </td>
          </tr>
          <tr>
            <th>Repository</th>
            <td>
              <a href={icons.gitRepository}>{icons.gitRepository}</a>
            </td>
          </tr>
        </tbody>
      </table>

      <div>
        <pre
          className={css`
            font-size: 1.3em;
          `}
        >
          <code>{`import { IconName } from "react-icons/${icons.id}";`}</code>
        </pre>
      </div>

      <IconList>{list}</IconList>
    </div>
  );
}

function IconList({
  children: list,
  onSelect,
}: {
  children: IconEntry[];
  onSelect?: (icon: IconEntry) => void;
}) {
  return (
    <div
      className={css`
        column-width: 10em;
        column-rule: 1px solid #ddd;
        font-size: 1.65em;
        line-height: 1.4em;
        margin-bottom: 30px;
        @media (prefers-color-scheme: dark) {
          column-rule-color: rgb(47, 47, 47);
        }
      `}
    >
      {list.map(icon => (
        <button
          key={icon.package + "_" + icon.name}
          className={css`
            border: none;
            background: transparent;
            color: inherit;
            cursor: pointer;
            display: flex;
            font-size: inherit;
            line-height: inherit;
            align-items: center;
            gap: 5px;
            width: 100%;
            &:hover {
              background: #eee;
              text-decoration: underline;
              @media (prefers-color-scheme: dark) {
                background: #333;
              }
            }
          `}
          onClick={() => {
            void navigator.clipboard.writeText(icon.name);
            onSelect?.(icon);
          }}
          title="Click to copy icon name to clipboard"
        >
          <Icon
            icon={icon.icon}
            className={cx(
              icon.package === "gr" &&
                css`
                  fill: #000;
                  @media (prefers-color-scheme: dark) {
                    fill: #fff;
                  }
                `,
              css`
                &:hover {
                  background: #eee;
                  border-radius: 3px;
                  transform: scale(1.5);
                  transition: transform 0.05s;
                  padding: 4px;
                  margin-left: -8px;
                  @media (prefers-color-scheme: dark) {
                    background: #111;
                  }
                }
              `
            )}
          />
          <code
            className={css`
              font-size: 0.8em;
            `}
          >
            {icon.name}
            {icon.name.toLowerCase().startsWith(icon.package) || (
              <span
                className={css`
                  filter: opacity(0.5);
                `}
              >{` (${icon.package})`}</span>
            )}
          </code>
        </button>
      ))}
    </div>
  );
}

function SearchPage({ search, icons }: { search: string; icons: IconEntry[] }) {
  return (
    <div>
      <h1>Search</h1>
      <div
        className={css`
          margin-bottom: 10px;
        `}
      >
        <div>
          Keyword: {search.replaceAll("%20", " ")} ({icons.length} results)
        </div>
      </div>
      <IconList>{icons}</IconList>
    </div>
  );
}

export default App;
