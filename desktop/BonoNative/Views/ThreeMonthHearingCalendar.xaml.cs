using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

namespace BonoNative.Views;

/// <summary>Full-panel month grid matching the original web calendar: no WPF Calendar thumbnail.</summary>
public partial class ThreeMonthHearingCalendar : UserControl
{
    private readonly CultureInfo _tr = CultureInfo.GetCultureInfo("tr-TR");
    private IReadOnlyList<HearingEntry> _hearings = Array.Empty<HearingEntry>();
    private DateTime _baseMonth = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    private static readonly Brush Panel = Brush("#17191D");
    private static readonly Brush Line = Brush("#34383D");
    private static readonly Brush Ink = Brush("#EDF1F4");
    private static readonly Brush Muted = Brush("#969DA5");
    private static Brush Brush(string hex) => (Brush)new BrushConverter().ConvertFromString(hex)!;
    public event EventHandler<HearingEntry>? HearingOpened;

    public ThreeMonthHearingCalendar()
    {
        InitializeComponent();
        Render();
    }

    public void SetHearings(IEnumerable<HearingEntry> rows)
    {
        _hearings = rows.ToList();
        Render();
    }

    private void Render()
    {
        if (MonthsHost == null) return;
        MonthsHost.Children.Clear();
        for (int m = 0; m < 3; m++)
        {
            var month = _baseMonth.AddMonths(m);
            var frame = new Border
            {
                Background = Panel, BorderBrush = Line, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5), Padding = new Thickness(7)
            };
            Grid.SetColumn(frame, m * 2);
            MonthsHost.Children.Add(frame);
            var shell = new Grid();
            frame.Child = shell;
            shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(46) });
            shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(35) });
            shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var title = new TextBlock
            {
                Text = month.ToString("MMMM yyyy", _tr), FontWeight = FontWeights.Bold,
                FontSize = 17, Foreground = Ink, HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            shell.Children.Add(title);
            var week = new UniformGrid { Columns = 7 };
            Grid.SetRow(week, 1);
            shell.Children.Add(week);
            foreach (var name in new[] { "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz" })
                week.Children.Add(new TextBlock
                {
                    Text = name, Foreground = Muted, FontSize = 11,
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center
                });

            var offset = ((int)month.DayOfWeek + 6) % 7;
            var days = DateTime.DaysInMonth(month.Year, month.Month);
            var count = (int)Math.Ceiling((offset + days) / 7.0) * 7;
            var cells = new Grid();
            Grid.SetRow(cells, 2);
            shell.Children.Add(cells);
            for (int j = 0; j < 7; j++) cells.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (int j = 0; j < count / 7; j++) cells.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            for (int j = 0; j < count; j++)
            {
                var day = j - offset + 1;
                var valid = day > 0 && day <= days;
                var date = valid ? month.AddDays(day - 1) : DateTime.MinValue;
                var items = valid ? _hearings.Where(h => h.Start.Date == date.Date).OrderBy(h => h.Start).ToList() : new List<HearingEntry>();
                var cell = new Border
                {
                    Background = !valid ? Brush("#141619") : items.Count > 0 ? Brush("#18232B") : Panel,
                    BorderBrush = Line, BorderThickness = new Thickness(0, 0, 1, 1),
                    Padding = new Thickness(5), MinHeight = 93
                };
                Grid.SetRow(cell, j / 7);
                Grid.SetColumn(cell, j % 7);
                cells.Children.Add(cell);
                if (!valid) continue;
                var stack = new StackPanel();
                cell.Child = stack;
                stack.Children.Add(new TextBlock
                {
                    Text = day.ToString(_tr), Foreground = date.Date == DateTime.Today ? Brush("#66CFFD") : Ink,
                    FontSize = 12, FontWeight = date.Date == DateTime.Today ? FontWeights.Bold : FontWeights.Normal,
                    Margin = new Thickness(0, 0, 0, 4)
                });
                foreach (var h in items.Take(2))
                {
                    var entry = h;
                    var button = new Button
                    {
                        Content = new TextBlock
                        {
                            Text = h.Start.ToString("HH:mm") + " " + h.FileNo,
                            TextTrimming = TextTrimming.CharacterEllipsis, FontSize = 10,
                            Foreground = Brush("#DCEFF8")
                        },
                        Background = Brush("#12303D"), BorderBrush = Brush("#19AEE6"),
                        BorderThickness = new Thickness(2, 0, 0, 0), Padding = new Thickness(3, 4, 2, 4),
                        Margin = new Thickness(0, 2, 0, 0), HorizontalContentAlignment = HorizontalAlignment.Stretch,
                        ToolTip = h.Court + " · " + h.FileNo + " · " + h.Start.ToString("dd.MM.yyyy HH:mm")
                    };
                    button.Click += (_, _) => HearingOpened?.Invoke(this, entry);
                    stack.Children.Add(button);
                }
                if (items.Count > 2)
                    stack.Children.Add(new TextBlock { Text = "+" + (items.Count - 2) + " duruşma", Foreground = Brush("#59C9F2"), FontSize = 10 });
            }
        }
    }

    public sealed record HearingEntry(DateTime Start, string Court, string FileNo, string Type, string Foy);
}
