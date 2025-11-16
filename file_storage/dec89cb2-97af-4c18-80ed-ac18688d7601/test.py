def show_last_20_lines(file_path):
    with open(file_path, 'r') as file:
        lines = file.readlines()
        for line in lines[-20:]:
            print(line, end='')

# Example usage:
# show_last_20_lines('your_file.txt')