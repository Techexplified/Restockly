import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      height: "100vh",
      width: "100vw",
      backgroundColor: "#f6f6f7",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      paddingTop: "48px",
      margin: 0,
      boxSizing: "border-box"
    }}>
      <h1 style={{
        fontSize: "14px",
        fontWeight: "500",
        color: "#202223",
        margin: "0 0 40px 0"
      }}>
        Restockly
      </h1>
      <p style={{
        fontSize: "18px",
        fontWeight: "400",
        color: "#202223",
        margin: 0
      }}>
        Open this app from your Shopify admin to get started.
      </p>
    </div>
  );
}
